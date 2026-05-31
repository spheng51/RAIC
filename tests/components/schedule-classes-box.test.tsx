// @vitest-environment jsdom

import {
  act,
  createContext,
  createElement,
  useContext,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleDiscordIntegrationState } from '@/components/schedule/schedule-classes-box';
import type { ScheduledClassEvent } from '@/lib/types/scheduled-classes';

vi.mock('@/components/ui/button', async () => {
  const React = await import('react');
  return {
    Button: ({
      asChild,
      children,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> &
      AnchorHTMLAttributes<HTMLAnchorElement> & {
        asChild?: boolean;
        children?: ReactNode;
      }) => {
      if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children as ReactElement<Record<string, unknown>>, props);
      }
      return React.createElement('button', props, children);
    },
  };
});

vi.mock('@/components/ui/dialog', async () => {
  const React = await import('react');
  const Shell = ({
    children,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) =>
    React.createElement('div', props, children);
  return {
    Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
      open ? React.createElement('div', null, children) : null,
    DialogContent: Shell,
    DialogDescription: Shell,
    DialogFooter: Shell,
    DialogHeader: Shell,
    DialogTitle: Shell,
  };
});

vi.mock('@/components/ui/input', async () => {
  const React = await import('react');
  return {
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', props),
  };
});

vi.mock('@/components/ui/label', async () => {
  const React = await import('react');
  return {
    Label: (props: LabelHTMLAttributes<HTMLLabelElement>) => React.createElement('label', props),
  };
});

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const SelectContext = createContext<{
    onValueChange?: (value: string) => void;
    value?: string;
  }>({});
  return {
    Select: ({
      value,
      onValueChange,
      children,
    }: {
      value?: string;
      onValueChange?: (value: string) => void;
      children?: ReactNode;
    }) =>
      React.createElement(
        SelectContext.Provider,
        { value: { value, onValueChange } },
        React.createElement('div', null, children),
      ),
    SelectTrigger: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', null, children),
    SelectItem: ({ value, children }: { value: string; children?: ReactNode }) => {
      const context = useContext(SelectContext);
      return React.createElement(
        'button',
        {
          type: 'button',
          'aria-pressed': context.value === value,
          onClick: () => context.onValueChange?.(value),
        },
        children,
      );
    },
  };
});

vi.mock('@/components/ui/switch', async () => {
  const React = await import('react');
  return {
    Switch: ({
      checked,
      onCheckedChange,
      ...props
    }: {
      checked?: boolean;
      onCheckedChange?: (checked: boolean) => void;
    }) =>
      React.createElement('button', {
        ...props,
        type: 'button',
        role: 'switch',
        'aria-checked': checked ? 'true' : 'false',
        onClick: () => onCheckedChange?.(!checked),
      }),
  };
});

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'home.schedule.title': 'Schedule Classes',
        'home.schedule.add': 'Add',
        'home.schedule.empty': 'No classes scheduled',
        'home.schedule.addTitle': 'Add scheduled class',
        'home.schedule.editTitle': 'Edit scheduled class',
        'home.schedule.dialogDescription': 'Create a one-time class event.',
        'home.schedule.formTitle': 'Class title',
        'home.schedule.date': 'Date',
        'home.schedule.time': 'Time',
        'home.schedule.duration': 'Duration',
        'home.schedule.minutes': 'min',
        'home.schedule.classroom': 'Classroom',
        'home.schedule.noClassroom': 'No classroom',
        'home.schedule.unlinkedClassroom': 'Unlinked classroom',
        'home.schedule.create': 'Create',
        'home.schedule.createAndJoin': 'Create & join',
        'home.schedule.save': 'Save',
        'home.schedule.edit': 'Edit scheduled class',
        'home.schedule.delete': 'Delete',
        'home.schedule.saveFailed': 'Failed to save scheduled class',
        'home.schedule.deleteFailed': 'Failed to delete scheduled class',
        'home.schedule.discord.title': 'Discord',
        'home.schedule.discord.notConfigured': 'Discord is not configured',
        'home.schedule.discord.notConnected': 'Not connected',
        'home.schedule.discord.connect': 'Connect Discord',
        'home.schedule.discord.noChannel': 'No channel',
        'home.schedule.discord.saveChannel': 'Save channel',
        'home.schedule.discord.disconnect': 'Disconnect Discord',
        'home.schedule.discord.syncClass': 'Sync with Discord',
        'home.schedule.discord.openEvent': 'Open Discord event',
        'home.schedule.discord.synced': 'Discord synced',
        'home.schedule.discord.reminderSent': 'Discord reminder sent',
        'home.schedule.discord.warning': 'Discord warning',
        'home.schedule.discord.actionFailed': 'Discord action failed',
        'common.cancel': 'Cancel',
      };
      return labels[key] ?? key;
    },
  }),
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

interface ScheduleClassesBoxTestProps {
  events: ScheduledClassEvent[];
  classrooms: Array<{ id: string; name: string; creationMode?: 'course' | 'game-arcade' }>;
  onCreate: (input: unknown) => Promise<void>;
  onUpdate: (id: string, input: unknown) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenClassroom: (classroomId: string) => void;
  gameModeActive?: boolean;
  discordIntegration?: ScheduleDiscordIntegrationState;
}

function makeEvent(id: string, startsAt: string, classroomId?: string): ScheduledClassEvent {
  return {
    id,
    title: `Class ${id}`,
    startsAt,
    ...(classroomId ? { classroomId } : {}),
    createdAt: '2026-05-11T00:00:00.000Z',
    updatedAt: '2026-05-11T00:00:00.000Z',
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function findButton(container: HTMLElement, text: string) {
  return [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
}

function makeDiscordIntegration(
  overrides: Partial<ScheduleDiscordIntegrationState> = {},
): ScheduleDiscordIntegrationState {
  const connection = {
    id: 'connection-1',
    guildId: 'guild-1',
    guildName: 'Physics Guild',
    channelId: 'channel-1',
    channelName: 'announcements',
  };
  const resolvedConnection = Object.prototype.hasOwnProperty.call(overrides, 'connection')
    ? (overrides.connection ?? null)
    : connection;
  const resolvedConnections = Object.prototype.hasOwnProperty.call(overrides, 'connections')
    ? (overrides.connections ?? [])
    : resolvedConnection
      ? [resolvedConnection]
      : [];

  return {
    configured: true,
    connection: resolvedConnection,
    connections: resolvedConnections,
    channels: [
      { id: 'channel-1', name: 'announcements' },
      { id: 'channel-2', name: 'study-hall' },
    ],
    onConnect: vi.fn(),
    onSelectConnection: vi.fn().mockResolvedValue(undefined),
    onSaveChannel: vi.fn().mockResolvedValue(undefined),
    onDisconnect: vi.fn().mockResolvedValue(undefined),
    onSyncEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

async function mountBox(props: Partial<ScheduleClassesBoxTestProps> = {}) {
  const { ScheduleClassesBox } = await import('@/components/schedule/schedule-classes-box');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  const defaults = {
    events: [],
    classrooms: [],
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onOpenClassroom: vi.fn(),
  };

  await act(async () => {
    root.render(createElement(ScheduleClassesBox, { ...defaults, ...props }));
  });
  await flushEffects();

  return { container, props: { ...defaults, ...props } };
}

describe('ScheduleClassesBox', () => {
  beforeEach(() => {
    vi.resetModules();
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) continue;
      await act(async () => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
  });

  it('renders an empty state and creates a scheduled class from the dialog', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container } = await mountBox({ onCreate });

    expect(container.textContent).toContain('Schedule Classes');
    expect(container.textContent).toContain('No classes scheduled');

    await act(async () => {
      findButton(container, 'Add')?.click();
    });
    const titleInput = container.querySelector<HTMLInputElement>('#scheduled-class-title');
    const dateInput = container.querySelector<HTMLInputElement>('#scheduled-class-date');
    const timeInput = container.querySelector<HTMLInputElement>('#scheduled-class-time');
    expect(titleInput).toBeTruthy();
    expect(dateInput).toBeTruthy();
    expect(timeInput).toBeTruthy();

    await act(async () => {
      setInputValue(titleInput!, 'Office hours');
      setInputValue(dateInput!, '2099-05-12');
      setInputValue(timeInput!, '17:00');
    });
    expect(findButton(container, 'Create & join')).toBeTruthy();

    await act(async () => {
      findButton(container, 'Create & join')?.click();
    });

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Office hours',
        startsAt: expect.any(String),
      }),
    );
  });

  it('creates and opens a selected classroom from the dialog', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onOpenClassroom = vi.fn();
    const { container } = await mountBox({
      classrooms: [{ id: 'room-1', name: 'Physics room' }],
      onCreate,
      onOpenClassroom,
    });

    await act(async () => {
      findButton(container, 'Add')?.click();
    });
    const titleInput = container.querySelector<HTMLInputElement>('#scheduled-class-title');
    const dateInput = container.querySelector<HTMLInputElement>('#scheduled-class-date');
    const timeInput = container.querySelector<HTMLInputElement>('#scheduled-class-time');

    await act(async () => {
      setInputValue(titleInput!, 'Physics lab');
      setInputValue(dateInput!, '2099-05-12');
      setInputValue(timeInput!, '17:00');
      findButton(container, 'Physics room')?.click();
    });
    await act(async () => {
      findButton(container, 'Create & join')?.click();
    });

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Physics lab',
        classroomId: 'room-1',
      }),
    );
    expect(onOpenClassroom).toHaveBeenCalledWith('room-1');
  });

  it('hides Discord controls unless a teacher Discord integration is provided', async () => {
    const { container } = await mountBox({
      classrooms: [{ id: 'room-1', name: 'Physics room' }],
      events: [makeEvent('1', '2099-05-12T17:00:00.000Z', 'room-1')],
    });

    expect(container.querySelector('[data-testid="schedule-discord-panel"]')).toBeNull();
    expect(container.textContent).not.toContain('Discord');
  });

  it('shows a disabled Discord setup state when the integration is not configured', async () => {
    const discordIntegration = makeDiscordIntegration({
      configured: false,
      connection: null,
      channels: [],
    });
    const { container } = await mountBox({ discordIntegration });

    expect(container.textContent).toContain('Discord is not configured');
    expect(findButton(container, 'Connect Discord')?.disabled).toBe(true);
    expect(discordIntegration.onConnect).not.toHaveBeenCalled();
  });

  it('lets teachers disconnect a stale Discord connection when config is missing', async () => {
    const discordIntegration = makeDiscordIntegration({
      configured: false,
      channels: [],
    });
    const { container } = await mountBox({ discordIntegration });

    expect(container.textContent).toContain('Discord is not configured');
    expect(findButton(container, 'Connect Discord')?.disabled).toBe(true);

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Disconnect Discord"]')
        ?.click();
    });

    expect(discordIntegration.onConnect).not.toHaveBeenCalled();
    expect(discordIntegration.onDisconnect).toHaveBeenCalledWith('connection-1');
  });

  it('shows recoverable Discord integration warnings in the setup row', async () => {
    const { container } = await mountBox({
      discordIntegration: makeDiscordIntegration({
        channels: [],
        error: 'Unable to load Discord announcement channels.',
      }),
    });

    expect(container.textContent).toContain('Unable to load Discord announcement channels.');
  });

  it('saves and disconnects a connected Discord announcement channel', async () => {
    const discordIntegration = makeDiscordIntegration();
    const { container } = await mountBox({ discordIntegration });

    await act(async () => {
      findButton(container, '#study-hall')?.click();
    });
    await act(async () => {
      findButton(container, 'Save channel')?.click();
    });
    expect(discordIntegration.onSaveChannel).toHaveBeenCalledWith('connection-1', 'channel-2');

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Disconnect Discord"]')
        ?.click();
    });
    expect(discordIntegration.onDisconnect).toHaveBeenCalledWith('connection-1');
  });

  it('adds multiplayer metadata for game-mode scheduled classes', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { container } = await mountBox({
      gameModeActive: true,
      classrooms: [{ id: 'room-1', name: 'Physics game', creationMode: 'game-arcade' }],
      onCreate,
    });

    await act(async () => {
      findButton(container, 'Add')?.click();
    });
    const titleInput = container.querySelector<HTMLInputElement>('#scheduled-class-title');
    const dateInput = container.querySelector<HTMLInputElement>('#scheduled-class-date');
    const timeInput = container.querySelector<HTMLInputElement>('#scheduled-class-time');

    await act(async () => {
      setInputValue(titleInput!, 'Physics game');
      setInputValue(dateInput!, '2099-05-12');
      setInputValue(timeInput!, '17:00');
      findButton(container, 'Physics game')?.click();
      container.querySelector<HTMLButtonElement>('[role="switch"]')?.click();
    });
    await act(async () => {
      findButton(container, 'Create & join')?.click();
    });

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 'room-1',
        multiplayerGame: {
          enabled: true,
          mode: 'both',
          linkPolicy: 'always_open',
        },
      }),
    );
  });

  it('shows at most five upcoming events and opens linked classrooms', async () => {
    const onOpenClassroom = vi.fn();
    const { container } = await mountBox({
      classrooms: [{ id: 'room-1', name: 'Physics room' }],
      events: [
        makeEvent('past', '2020-05-11T17:00:00.000Z'),
        makeEvent('1', '2099-05-12T17:00:00.000Z', 'room-1'),
        makeEvent('2', '2099-05-13T17:00:00.000Z'),
        makeEvent('3', '2099-05-14T17:00:00.000Z'),
        makeEvent('4', '2099-05-15T17:00:00.000Z'),
        makeEvent('5', '2099-05-16T17:00:00.000Z'),
        makeEvent('6', '2099-05-17T17:00:00.000Z'),
      ],
      onOpenClassroom,
    });

    expect(container.textContent).toContain('Class 1');
    expect(container.textContent).toContain('Class 5');
    expect(container.textContent).not.toContain('Class 6');
    expect(container.textContent).not.toContain('Class past');

    await act(async () => {
      findButton(container, 'Class 1')?.click();
    });
    expect(onOpenClassroom).toHaveBeenCalledWith('room-1');
  });

  it('syncs linked scheduled classes with Discord and shows sync status', async () => {
    const discordIntegration = makeDiscordIntegration();
    const syncedEvent: ScheduledClassEvent = {
      ...makeEvent('1', '2099-05-12T17:00:00.000Z', 'room-1'),
      discordSync: {
        enabled: true,
        scheduledEventUrl: 'https://discord.com/events/guild-1/discord-event-1',
        lastSyncedAt: '2026-05-12T16:00:00.000Z',
        syncWarning: 'Discord rate limited this update.',
      },
    };
    const { container } = await mountBox({
      classrooms: [{ id: 'room-1', name: 'Physics room' }],
      events: [syncedEvent],
      discordIntegration,
    });

    expect(container.textContent).toContain('Discord warning');
    expect(container.textContent).toContain('Discord rate limited this update.');
    expect(
      container.querySelector<HTMLAnchorElement>(
        'a[href="https://discord.com/events/guild-1/discord-event-1"]',
      ),
    ).toBeTruthy();

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Sync with Discord"]')?.click();
    });
    expect(discordIntegration.onSyncEvent).toHaveBeenCalledWith('1', 'connection-1');
  });

  it('lets teachers select which Discord guild to use for scheduled class sync', async () => {
    const discordIntegration = makeDiscordIntegration({
      connections: [
        {
          id: 'connection-1',
          guildId: 'guild-1',
          guildName: 'Physics Guild',
          channelId: 'channel-1',
          channelName: 'announcements',
        },
        {
          id: 'connection-2',
          guildId: 'guild-2',
          guildName: 'Chemistry Guild',
          channelId: 'channel-2',
          channelName: 'study-hall',
        },
      ],
    });
    const { container } = await mountBox({
      classrooms: [{ id: 'room-1', name: 'Physics room' }],
      events: [makeEvent('1', '2099-05-12T17:00:00.000Z', 'room-1')],
      discordIntegration,
    });

    await act(async () => {
      findButton(container, 'Chemistry Guild')?.click();
    });
    expect(discordIntegration.onSelectConnection).toHaveBeenCalledWith('connection-2');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Sync with Discord"]')?.click();
    });
    expect(discordIntegration.onSyncEvent).toHaveBeenCalledWith('1', 'connection-2');
  });

  it.each(['javascript:alert(1)', 'https://discord.com/events/guild-1/event-1?token=secret'])(
    'does not render unsafe Discord scheduled event links',
    async (scheduledEventUrl) => {
      const unsafeEvent: ScheduledClassEvent = {
        ...makeEvent('1', '2099-05-12T17:00:00.000Z', 'room-1'),
        discordSync: {
          enabled: true,
          scheduledEventUrl,
          lastSyncedAt: '2026-05-12T16:00:00.000Z',
        },
      };
      const { container } = await mountBox({
        classrooms: [{ id: 'room-1', name: 'Physics room' }],
        events: [unsafeEvent],
        discordIntegration: makeDiscordIntegration(),
      });

      expect(container.querySelector('a[aria-label="Open Discord event"]')).toBeNull();
      expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
      expect(container.querySelector('a[href*="token=secret"]')).toBeNull();
      expect(container.textContent).toContain('Discord synced');
    },
  );

  it('disables Discord sync for scheduled classes without a linked classroom', async () => {
    const { container } = await mountBox({
      events: [makeEvent('1', '2099-05-12T17:00:00.000Z')],
      discordIntegration: makeDiscordIntegration(),
    });

    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Sync with Discord"]')
        ?.disabled,
    ).toBe(true);
  });

  it('disables Discord sync for scheduled classes with stale classroom links', async () => {
    const discordIntegration = makeDiscordIntegration();
    const { container } = await mountBox({
      classrooms: [{ id: 'room-2', name: 'Chemistry room' }],
      events: [makeEvent('1', '2099-05-12T17:00:00.000Z', 'room-1')],
      discordIntegration,
    });

    expect(container.textContent).toContain('Unlinked classroom');
    const syncButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Sync with Discord"]',
    );
    expect(syncButton?.disabled).toBe(true);

    await act(async () => {
      syncButton?.click();
    });
    expect(discordIntegration.onSyncEvent).not.toHaveBeenCalled();
  });

  it('updates and deletes an existing scheduled class', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { container } = await mountBox({
      events: [makeEvent('1', '2099-05-12T17:00:00.000Z')],
      onUpdate,
      onDelete,
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Edit scheduled class"]')
        ?.click();
    });
    const titleInput = container.querySelector<HTMLInputElement>('#scheduled-class-title');
    await act(async () => {
      setInputValue(titleInput!, 'Updated class');
    });
    await act(async () => {
      findButton(container, 'Save')?.click();
    });
    expect(onUpdate).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({
        title: 'Updated class',
      }),
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Edit scheduled class"]')
        ?.click();
    });
    await act(async () => {
      findButton(container, 'Delete')?.click();
    });
    expect(onDelete).toHaveBeenCalledWith('1');
  });
});
