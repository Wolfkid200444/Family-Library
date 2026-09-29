import { describe, expect, test } from 'bun:test';
import { familySignature, groupGames } from '../frontend/grouping';
import { parseLenders, readFamily, steamId, updateCollection } from '../frontend/steam';
import type { Family } from '../frontend/steam';

const family: Family = {
    accountid: 100,
    members: [200, 300].map(id => ({ accountid: id, steamid: steamId(id), name: `Friend ${id}`, avatar: '' })),
    games: [
        { appid: 10, owner: 200, copies: 1 },
        { appid: 20, owner: 0, copies: 2 },
        { appid: 30, owner: 200, copies: 2 },
    ],
};

describe('family ownership', () => {
    test('includes exclusive games, personally owned overlaps, and every shared owner', () => {
        const groups = groupGames(family, new Map([
            [10, [steamId(200)]],
            [20, [steamId(100), steamId(300)]],
            [30, [steamId(200), steamId(300), steamId(999)]],
        ]));
        expect(groups.get(200)).toEqual([10, 30]);
        expect(groups.get(300)).toEqual([20, 30]);
        expect(groups.has(100)).toBe(false);
        expect(groups.has(999)).toBe(false);
    });
    test('refuses an incomplete scan instead of dropping games from collections', () => {
        expect(() => groupGames(family, new Map())).toThrow('has not loaded');
    });
    test('does not rescan just because library sort order changes', () => {
        expect(familySignature(family)).toBe(familySignature({ ...family, games: [...family.games].reverse() }));
        expect(familySignature(family)).not.toBe(familySignature({ ...family, accountid: 101 }));
    });
    test('validates and deduplicates native lender responses', () => {
        expect(parseLenders([{ steamid: steamId(200) }, { steamid: steamId(200) }])).toEqual([steamId(200)]);
        expect(() => parseLenders({ lenders: [] })).toThrow();
        expect(() => parseLenders([{ steamid: 76561197960265928 }])).toThrow();
        expect(() => parseLenders([{ steamid: '99999999999999999' }])).toThrow();
    });
    test('skips personally owned games with no optional owner field but keeps overlaps', () => {
        const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
        Object.defineProperty(globalThis, 'window', { configurable: true, value: {
            App: { GetCurrentUser: () => ({ rgFamilyGroupMembers: [{ accountid: 100 }, { accountid: 200 }] }) },
            friendStore: { currentUserSteamID: { GetAccountID: () => 100 }, GetFriendState: () => ({ display_name: 'Friend' }) },
            appStore: { allApps: [
                { appid: 1, app_type: 1, number_of_copies: 1 },
                { appid: 2, app_type: 1, number_of_copies: 2 },
                { appid: 3, app_type: 1, owner_account_id: 200, number_of_copies: 1 },
            ] },
        } });
        try { expect(readFamily().games.map(game => game.appid)).toEqual([2, 3]); }
        finally {
            if (previous) Object.defineProperty(globalThis, 'window', previous);
            else Reflect.deleteProperty(globalThis, 'window');
        }
    });
    test('does not add a non-shareable owned game merely because it has multiple copies', () => {
        expect(groupGames(family, new Map([[10, [steamId(200)]], [20, []], [30, [steamId(300)]]])).get(300)).toEqual([30]);
    });
    test('updates observable collection sets and restores them if saving fails', async () => {
        function observableSet(ids: number[]) {
            const values = new Set(ids);
            return { get size() { return values.size; }, has: (id: number) => values.has(id),
                add: (id: number) => values.add(id), clear: () => values.clear(),
                [Symbol.iterator]: () => values[Symbol.iterator]() };
        }
        const added = observableSet([10]);
        const removed = observableSet([40]);
        let fail = false;
        let saves = 0;
        const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
        Object.defineProperty(globalThis, 'window', { configurable: true, value: {
            collectionStore: { GetCollection: () => ({ bIsDynamic: false, bIsEditable: true,
                internalAddedList: added, internalRemovedList: removed,
                Save: async () => { saves++; if (fail) throw new Error('offline'); }, UpdateAllApps: () => {} }) },
        } });
        try {
            await updateCollection('test', [10, 20]);
            expect([...added]).toEqual([10, 20]);
            expect([...removed]).toEqual([]);
            await updateCollection('test', [10, 20]);
            expect(saves).toBe(1);
            fail = true;
            await expect(updateCollection('test', [30])).rejects.toThrow('offline');
            expect([...added]).toEqual([10, 20]);
        } finally {
            if (previous) Object.defineProperty(globalThis, 'window', previous);
            else Reflect.deleteProperty(globalThis, 'window');
        }
    });
});
