import { definePlugin, DialogButton, Field, pluginConfig, usePluginConfig } from 'millennium';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { getOwners, getStatus, refresh, start, stop, subscribe } from './library';
import { openProfile, profile, readFamily } from './steam';
import type { Member } from './steam';


function Owner({ member }: { member: Member }) {
    return <DialogButton
        onClick={() => openProfile(member)}
        title={`Owned by ${member.name}. Open Steam profile.`}
        style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            color: 'inherit', fontSize: 'inherit', lineHeight: '24px', whiteSpace: 'nowrap' }}
    >
        {member.avatar && <img src={member.avatar} alt="" width={22} height={22}
            style={{ borderRadius: 3, objectFit: 'cover' }} />}
        <span>{member.name}</span>
    </DialogButton>;
}

function Owners({ appid }: { appid: number }) {
    const [members, setMembers] = useState<Member[]>([]);
    const [enabled] = usePluginConfig<string>('showOwners');
    useEffect(() => {
        let mounted = true;
        setMembers([]);
        if (enabled !== 'false') {
            getOwners(appid).then(ids => {
                if (!mounted) return;
                const family = readFamily();
                setMembers(family.members.filter(member => ids.includes(member.steamid)).map(member => profile(member.accountid)));
            }).catch(error => console.warn({ event: 'owners_unavailable', appid, message: String(error) }));
        }
        return () => { mounted = false; };
    }, [appid, enabled]);
    if (enabled === 'false' || !members.length) return null;
    return <span className="family-library-owners" aria-label="Game owners"
        style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginLeft: 10 }}>
        {members.map(member => <Owner key={member.accountid} member={member} />)}
    </span>;
}

/** @ffi */
export const ownerBadge = {
    render(appid: number): ReactElement { return <Owners appid={appid} />; },
};

function Settings() {
    const status = useSyncExternalStore(subscribe, getStatus);
    const [autoSync] = usePluginConfig<string>('autoSync');
    const [showOwners] = usePluginConfig<string>('showOwners');
    const [settingsError, setSettingsError] = useState('');
    async function toggle(key: string, current: string | undefined) {
        try { await pluginConfig.set(key, current === 'false' ? 'true' : 'false'); setSettingsError(''); }
        catch (error) { setSettingsError(String(error)); }
    }
    return <>
        <Field label="Family collections" description={status.message}>
            <DialogButton disabled={status.kind === 'working'} onClick={() => { void refresh(); }}>
                {status.kind === 'working' ? 'Updating…' : 'Refresh collections'}
            </DialogButton>
        </Field>
        {status.kind === 'ready' && status.groups.map(({ member, count }) =>
            <Field key={member.accountid} label={<Owner member={member} />} description={`${count} shared games`} />)}
        <Field label="Update collections automatically" description="Checks shared libraries once a minute and refreshes ownership every five minutes.">
            <DialogButton onClick={() => { void toggle('autoSync', autoSync); }}>{autoSync === 'false' ? 'Off' : 'On'}</DialogButton>
        </Field>
        <Field label="Show game owners" description="Adds profile pictures and names beside the Steam Family library label.">
            <DialogButton onClick={() => { void toggle('showOwners', showOwners); }}>{showOwners === 'false' ? 'Off' : 'On'}</DialogButton>
        </Field>
        <Field label="Your collections" description="Collections named Family · Name include every eligible shared copy, including games you also own. You can rename them; their contents are managed by this plugin." />
        {settingsError && <Field label="Could not save setting" description={settingsError} />}
    </>;
}

const Icon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 13a5 5 0 0 1 3 5v3" />
</svg>;

export default definePlugin(() => {
    console.info('Family Library frontend loaded');
    start();
    return { title: 'Family Library', icon: <Icon />, content: <Settings />, onDismount: stop };
});
