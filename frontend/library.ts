import { pluginConfig } from 'millennium';
import { collectionExists, currentAccount, lenders, newCollection, readFamily, record, updateCollection } from './steam';
import type { Member } from './steam';
import { familySignature, groupGames } from './grouping';

type Status = { kind: 'idle'; message: string } | { kind: 'working'; message: string }
    | { kind: 'ready'; message: string; groups: { member: Member; count: number }[] }
    | { kind: 'error'; message: string };
let status: Status = { kind: 'idle', message: 'Waiting for your Steam library…' };
const subscribers = new Set<() => void>();
let stopped = false;
let busy = false;
let lastSignature = '';
let lastRefresh = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let ownerAccount = 0;
const ownerCache = new Map<number, { expires: number; request: Promise<string[]> }>();

export function getStatus(): Status { return status; }
export function subscribe(callback: () => void): () => void {
    subscribers.add(callback);
    return () => { subscribers.delete(callback); };
}
function publish(next: Status): void { status = next; subscribers.forEach(callback => callback()); }

export function getOwners(appid: number, force = false): Promise<string[]> {
    const account = currentAccount();
    if (ownerAccount !== account) { ownerCache.clear(); ownerAccount = account; }
    const cached = ownerCache.get(appid);
    if (!force && cached && cached.expires > Date.now()) return cached.request;
    const request = lenders(appid).catch(error => { ownerCache.delete(appid); throw error; });
    ownerCache.set(appid, { expires: Date.now() + 300_000, request });
    return request;
}

async function managedIds(accountid: number): Promise<Record<string, string>> {
    const data: unknown = await pluginConfig.get(`collections_${accountid}`);
    if (data === undefined || data === null || data === '') return {};
    const parsed: unknown = typeof data === 'string' ? JSON.parse(data) : data;
    if (!record(parsed) || Object.values(parsed).some(id => typeof id !== 'string')) {
        throw new Error('The saved collection map is invalid. Your Steam collections were left untouched.');
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) if (typeof value === 'string') result[key] = value;
    return result;
}

export async function refresh(force = true): Promise<void> {
    if (busy || stopped) return;
    busy = true;
    const thisGeneration = generation;
    try {
        const family = readFamily();
        if (!family.members.length) {
            publish({ kind: 'idle', message: 'Join a Steam Family to see shared libraries here.' });
            return;
        }
        const signature = familySignature(family);
        if (!force && signature === lastSignature && Date.now() - lastRefresh < 300_000) return;
        publish({ kind: 'working', message: `Checking owners of ${family.games.length} shared games…` });
        const owners = new Map<number, string[]>();
        // Four native calls at once; yield between batches to keep Steam responsive.
        for (let i = 0; i < family.games.length; i += 4) {
            if (stopped || generation !== thisGeneration) return;
            await Promise.all(family.games.slice(i, i + 4).map(async game => {
                const ids = await getOwners(game.appid, force);
                // Owned games may report multiple copies even when the publisher
                // excludes them from sharing. Only borrowed games require a lender.
                if (!ids.length && game.owner > 0) throw new Error(`Steam has not loaded the owners of game ${game.appid} yet. Try Refresh again.`);
                owners.set(game.appid, ids);
            }));
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        // An account or library change during the scan must not rewrite collections.
        if (stopped || generation !== thisGeneration || familySignature(readFamily()) !== signature) return;
        const groups = groupGames(family, owners);
        const ids = await managedIds(family.accountid);
        for (const member of family.members) {
            if (stopped || generation !== thisGeneration || readFamily().accountid !== family.accountid) return;
            const appids = groups.get(member.accountid) ?? [];
            const id = ids[String(member.accountid)];
            if (id && collectionExists(id)) await updateCollection(id, appids);
            else {
                const created = newCollection(`Family · ${member.name}`, appids);
                ids[String(member.accountid)] = created.id;
                // Save the ID first, so a restart cannot orphan a collection.
                await pluginConfig.set(`collections_${family.accountid}`, JSON.stringify(ids));
                await created.save();
            }
        }
        lastSignature = signature;
        lastRefresh = Date.now();
        publish({ kind: 'ready', message: 'Family collections are up to date.',
            groups: family.members.map(member => ({ member, count: groups.get(member.accountid)?.length ?? 0 })) });
        console.info({ event: 'collections_synced', members: family.members.length, games: family.games.length });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not load your Steam Family.';
        publish({ kind: 'error', message });
        console.warn({ event: 'refresh_failed', message });
    } finally { busy = false; }
}

export function start(): void {
    stopped = false;
    async function tick(): Promise<void> {
        if (stopped) return;
        try {
            const enabled: unknown = await pluginConfig.get('autoSync');
            if (enabled !== 'false') await refresh(false);
        } catch (error) { console.warn({ event: 'auto_sync_failed', message: String(error) }); }
        if (!stopped) timer = setTimeout(tick, 60_000);
    }
    timer = setTimeout(tick, 3_000);
}

export function stop(): void {
    stopped = true;
    generation++;
    clearTimeout(timer);
    ownerCache.clear();
    subscribers.clear();
}
