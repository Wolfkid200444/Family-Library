import type { Family } from './steam';

export function groupGames(family: Family, owners: Map<number, string[]>): Map<number, number[]> {
    const groups = new Map(family.members.map(member => [member.accountid, new Set<number>()]));
    const bySteamId = new Map(family.members.map(member => [member.steamid, member.accountid]));
    for (const game of family.games) {
        const lenders = owners.get(game.appid);
        if (!lenders) throw new Error(`Ownership for game ${game.appid} has not loaded.`);
        for (const steamid of lenders) {
            const accountid = bySteamId.get(steamid);
            if (accountid !== undefined) groups.get(accountid)?.add(game.appid);
        }
    }
    return new Map([...groups].map(([id, games]) => [id, [...games].sort((a, b) => a - b)]));
}

export function familySignature(family: Family): string {
    return JSON.stringify([family.accountid, family.members.map(m => m.accountid).sort(),
        family.games.map(g => [g.appid, g.owner, g.copies]).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))]);
}
