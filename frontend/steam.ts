// Steam's internal stores are intentionally confined to this adapter.
export type Game = { appid: number; owner: number; copies: number };
export type Member = { accountid: number; steamid: string; name: string; avatar: string };
export type Family = { accountid: number; members: Member[]; games: Game[] };

export function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (!record(value)) throw new Error(`Steam ${label} is not ready.`);
    return value;
}

function invoke(owner: Record<string, unknown>, name: string, ...args: unknown[]): unknown {
    const fn = owner[name];
    if (typeof fn !== 'function') throw new Error(`Steam's ${name} interface is unavailable.`);
    return Reflect.apply(fn, owner, args);
}

function store(name: string): Record<string, unknown> {
    return object(object(window, 'window')[name], name);
}

function integer(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function steamId(accountid: number): string {
    return (76561197960265728n + BigInt(accountid)).toString();
}

export function profile(accountid: number): Member {
    const state = object(invoke(store('friendStore'), 'GetFriendState', accountid), 'friend');
    const persona = record(state.persona) ? state.persona : {};
    const name = typeof state.display_name === 'string' && state.display_name
        ? state.display_name : `Member ${accountid}`;
    const avatar = typeof persona.avatar_url_medium === 'string' ? persona.avatar_url_medium : '';
    return { accountid, steamid: steamId(accountid), name, avatar };
}

export function currentAccount(): number {
    const id = object(store('friendStore').currentUserSteamID, 'current Steam ID');
    const accountid = invoke(id, 'GetAccountID');
    if (!integer(accountid) || accountid === 0) throw new Error('Sign in to Steam to load your family.');
    return accountid;
}

export function readFamily(): Family {
    const app = store('App');
    const user = object(invoke(app, 'GetCurrentUser'), 'current user');
    if (!Array.isArray(user.rgFamilyGroupMembers)) throw new Error('Steam Family membership is not loaded.');
    const accountid = currentAccount();
    const members = user.rgFamilyGroupMembers.map((member: unknown) => {
        if (!record(member) || !integer(member.accountid)) throw new Error('Steam returned an unknown family member format.');
        return profile(member.accountid);
    }).filter(member => member.accountid !== accountid);
    const apps = store('appStore').allApps;
    if (!Array.isArray(apps) || !apps.length) throw new Error('Your Steam library is still loading.');
    const games: Game[] = [];
    for (const app of apps) {
        if (!record(app) || app.app_type !== 1 || !integer(app.appid)) continue;
        // Steam omits the optional owner field for personally owned games.
        const owner = app.owner_account_id === undefined ? 0 : app.owner_account_id;
        if (!integer(owner) || !integer(app.number_of_copies)) {
            throw new Error('Steam changed its library ownership format. Collections were left untouched.');
        }
        // A single personally owned copy cannot belong to another family member.
        // This avoids querying thousands of unrelated free-to-play games.
        if (owner > 0 || app.number_of_copies > 1) {
            games.push({ appid: app.appid, owner, copies: app.number_of_copies });
        }
    }
    return { accountid, members, games };
}

export function parseLenders(value: unknown): string[] {
    if (!Array.isArray(value)) throw new Error('Steam returned an unknown lender list.');
    const result = new Set<string>();
    for (const lender of value) {
        if (!record(lender) || typeof lender.steamid !== 'string' || !/^\d{17}$/.test(lender.steamid)
            || BigInt(lender.steamid) <= 76561197960265728n || BigInt(lender.steamid) > 76561202255233023n) {
            throw new Error('Steam returned an unknown lender format.');
        }
        result.add(lender.steamid);
    }
    return [...result];
}

export async function lenders(appid: number): Promise<string[]> {
    const client = store('SteamClient');
    const sharing = object(client.FamilySharing, 'Family Sharing');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            Promise.resolve(invoke(sharing, 'GetAvailableLenders', appid)),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Steam timed out while loading game owners.')), 15_000); }),
        ]);
        return parseLenders(result);
    } finally { clearTimeout(timer); }
}

export function openProfile(member: Member): void {
    invoke(object(store('SteamClient').URL, 'URL'), 'ExecuteSteamURL', `steam://url/SteamIDPage/${member.steamid}`);
}

export function collectionExists(id: string): boolean {
    return record(invoke(store('collectionStore'), 'GetCollection', id));
}

export function newCollection(name: string, appids: number[]): { id: string; save: () => Promise<void> } {
    const collections = store('collectionStore');
    let uniqueName = name.slice(0, 32);
    for (let suffix = 2; ; suffix++) {
        const matches = invoke(collections, 'GetUserCollectionsByName', uniqueName);
        if (!Array.isArray(matches)) throw new Error('Steam changed its collection lookup interface.');
        if (!matches.length) break;
        uniqueName = `${name.slice(0, 25)} (${suffix})`;
        if (suffix > 100) throw new Error('Could not find an unused family collection name.');
    }
    const collection = object(invoke(collections, 'NewUnsavedCollection', uniqueName, undefined, appids.map(appid => ({ appid }))), 'new collection');
    if (typeof collection.id !== 'string') throw new Error('Steam did not provide a collection ID.');
    return { id: collection.id, save: async () => { await invoke(collection, 'Save'); } };
}

export async function updateCollection(id: string, appids: number[]): Promise<void> {
    const collection = object(invoke(store('collectionStore'), 'GetCollection', id), 'collection');
    if (collection.bIsDynamic !== false || collection.bIsEditable !== true) {
        throw new Error('A managed collection was changed to a dynamic or protected collection. It was left untouched.');
    }
    const added = collection.internalAddedList;
    const removed = collection.internalRemovedList;
    // Steam wraps these sets with MobX, so instanceof Set is not reliable.
    if (!mutableGameSet(added) || !mutableGameSet(removed)) throw new Error('Steam changed its collection format.');
    if (added.size === appids.length && appids.every(id => added.has(id)) && removed.size === 0) return;
    const previousAdded = [...added];
    const previousRemoved = [...removed];
    added.clear();
    appids.forEach(id => added.add(id));
    removed.clear();
    try { await invoke(collection, 'Save'); }
    catch (error) {
        added.clear(); previousAdded.forEach(id => added.add(id));
        removed.clear(); previousRemoved.forEach(id => removed.add(id));
        invoke(collection, 'UpdateAllApps');
        throw error;
    }
}

type GameSet = Iterable<number> & { size: number; has(id: number): boolean; add(id: number): unknown; clear(): void };
function mutableGameSet(value: unknown): value is GameSet {
    if (!record(value) || !integer(value.size) || typeof value.has !== 'function'
        || typeof value.add !== 'function' || typeof value.clear !== 'function'
        || !(Symbol.iterator in value) || typeof value[Symbol.iterator] !== 'function') return false;
    return [...value as unknown as Iterable<unknown>].every(integer);
}
