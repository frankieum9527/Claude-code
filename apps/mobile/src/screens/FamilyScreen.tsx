import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ChildDto } from '@athlete-guide/shared-types';
import { DateTimeField } from '../components/DateTimeField';
import { API_URL } from '../config';
import { localToday, shiftDate } from '../dates';
import { colors, shared } from '../theme';
import { Chip } from '../ui';

/**
 * Guardian view: the player profiles this account manages. Kids under 13
 * can't create accounts — the guardian creates the profile, joins the team,
 * and owns video-upload consent (the API's COPPA gate). "View Today" flips
 * the Today tab to act for that child.
 */
interface Props {
  getAuthHeaders: () => Promise<Record<string, string>>;
  kids: ChildDto[];
  /** Data changed (child added, team joined, consent flipped) — refetch. */
  onChanged: () => void;
  onViewChild: (childId: string) => void;
}

export function FamilyScreen({ getAuthHeaders, kids, onChanged, onViewChild }: Props) {
  return (
    <View style={shared.root}>
      <ScrollView contentContainerStyle={shared.scroll}>
        <Text style={shared.sectionLabel}>Family</Text>
        <Text style={shared.h1}>Your players</Text>
        <Text style={shared.muted}>
          Profiles you manage. Kids under 13 don't get their own accounts — you create their
          profile, join their team with its code, and decide whether they can upload videos
          for coach review.
        </Text>

        {kids.map((kid) => (
          <ChildCard
            key={kid.id}
            kid={kid}
            getAuthHeaders={getAuthHeaders}
            onChanged={onChanged}
            onViewChild={onViewChild}
          />
        ))}

        <AddChildCard getAuthHeaders={getAuthHeaders} onChanged={onChanged} />
      </ScrollView>
    </View>
  );
}

function ChildCard({
  kid,
  getAuthHeaders,
  onChanged,
  onViewChild,
}: {
  kid: ChildDto;
  getAuthHeaders: () => Promise<Record<string, string>>;
  onChanged: () => void;
  onViewChild: (childId: string) => void;
}) {
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consented = kid.videoConsentAt !== null;

  const joinTeam = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/teams/join`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-child-id': kid.id, // join acts for the child
          ...(await getAuthHeaders()),
        },
        body: JSON.stringify({ joinCode: joinCode.trim() }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `API responded ${res.status}`);
      setJoinCode('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setConsent = async (videoUploads: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/me/children/${kid.id}/consent`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ videoUploads }),
      });
      if (!res.ok) throw new Error(`API responded ${res.status}`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={shared.card}>
      <View style={styles.headRow}>
        <Text style={shared.cardTitle}>{kid.name}</Text>
        <Chip label={`AGE ${kid.age}`} color={colors.practice} />
      </View>
      <Text style={shared.muted}>
        {kid.teams.length > 0 ? kid.teams.map((t) => t.name).join(', ') : 'Not on a team yet'}
      </Text>

      {kid.teams.length === 0 && (
        <View style={styles.joinRow}>
          <TextInput
            style={[shared.input, styles.joinInput]}
            placeholder="Team join code"
            placeholderTextColor={colors.muted}
            value={joinCode}
            onChangeText={setJoinCode}
            autoCapitalize="characters"
          />
          <Pressable
            style={[shared.button, styles.joinButton]}
            onPress={joinTeam}
            disabled={busy || !joinCode.trim()}
          >
            <Text style={shared.buttonText}>Join</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.consentRow}>
        <View style={styles.consentBody}>
          <Text style={styles.consentTitle}>Video uploads for coach review</Text>
          <Text style={shared.muted}>
            {consented
              ? `Approved ${kid.videoConsentAt!.slice(0, 10)}. You can revoke any time.`
              : kid.age < 13
                ? 'Required before videos can leave the device (under 13).'
                : 'Not approved.'}
          </Text>
        </View>
        <Pressable
          onPress={() => setConsent(!consented)}
          disabled={busy}
          accessibilityRole="switch"
          accessibilityState={{ checked: consented }}
          style={[styles.toggle, consented && styles.toggleOn]}
        >
          <Text style={consented ? styles.toggleTextOn : styles.toggleText}>
            {consented ? 'ON' : 'OFF'}
          </Text>
        </Pressable>
      </View>

      {error && <Text style={shared.errorText}>{error}</Text>}
      <Pressable onPress={() => onViewChild(kid.id)}>
        <Text style={[shared.link, styles.viewLink]}>View {kid.name.split(' ')[0]}'s Today →</Text>
      </Pressable>
    </View>
  );
}

function AddChildCard({
  getAuthHeaders,
  onChanged,
}: {
  getAuthHeaders: () => Promise<Record<string, string>>;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/me/children`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await getAuthHeaders()) },
        body: JSON.stringify({ name: name.trim(), birthdate: birthdate.trim() }),
      });
      const body = (await res.json()) as { error?: unknown };
      if (!res.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : `API responded ${res.status}`,
        );
      }
      setName('');
      setBirthdate('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={shared.card}>
      <Text style={shared.cardTitle}>Add a player</Text>
      <TextInput
        style={shared.input}
        placeholder="Player's name"
        placeholderTextColor={colors.muted}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
      />
      <DateTimeField
        mode="date"
        placeholder="Birthdate"
        value={birthdate}
        onChange={setBirthdate}
        maximumDate={localToday()}
        initialValue={shiftDate(localToday(), -10 * 365)}
      />
      {error && <Text style={shared.errorText}>{error}</Text>}
      <Pressable
        style={shared.button}
        onPress={submit}
        disabled={busy || !name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate.trim())}
      >
        <Text style={shared.buttonText}>{busy ? 'Adding…' : 'Add player'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  joinRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  joinInput: { flex: 1 },
  joinButton: { paddingHorizontal: 18 },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: 12,
  },
  consentBody: { flex: 1 },
  consentTitle: { color: colors.text, fontWeight: '700', fontSize: 14 },
  toggle: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 54,
    alignItems: 'center',
  },
  toggleOn: { backgroundColor: colors.success, borderColor: colors.success },
  toggleText: { color: colors.muted, fontWeight: '800', fontSize: 12 },
  toggleTextOn: { color: '#052E12', fontWeight: '800', fontSize: 12 },
  viewLink: { marginTop: 14 },
});
