import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemberNumberingPage } from './MemberNumberingPage';
import { memberNumberingService as realService } from '../services/member-numbering.service';
import { fakeServices } from '../test/fakes';
import { renderWithProviders, type RenderOptions } from '../test/render';
import { buildAdminProfile } from '../test/builders';
import { MOBILE_WIDTH } from '../test/viewport';
import type { BranchSequence, MemberNumberConfig } from '../types/member-numbering';

const YEAR = new Date().getFullYear();
const CONFIG: MemberNumberConfig = { start_sequence: 1, increment: 1, padding_width: 4 };
const SEQUENCES: BranchSequence[] = [
  { branch_id: 1, branch_name: 'Mumbai Central', branch_code: 'MUM', last_sequence: 41, next_sequence: 42 },
  { branch_id: 2, branch_name: 'Pune Camp', branch_code: 'PUN', last_sequence: null, next_sequence: 1 },
];

function renderNumbering(
  options: RenderOptions & {
    config?: MemberNumberConfig;
    getConfig?: ReturnType<typeof vi.fn>;
    getSequences?: ReturnType<typeof vi.fn>;
    updateSequence?: ReturnType<typeof vi.fn>;
    updateConfig?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const {
    config = CONFIG,
    getConfig = vi.fn().mockResolvedValue(config),
    getSequences = vi.fn().mockResolvedValue(SEQUENCES),
    updateSequence = vi.fn().mockResolvedValue({ next_sequence: 50, requested: 50, adjusted: false }),
    updateConfig = vi.fn().mockResolvedValue(undefined),
    ...rest
  } = options;
  const utils = renderWithProviders(<MemberNumberingPage />, {
    auth: { currentProfile: buildAdminProfile() },
    ...rest,
    services: fakeServices({
      memberNumberingRepository: { getConfig, getSequences, updateSequence },
      memberNumberingService: { ...realService, updateConfig },
    }),
  });
  return { ...utils, getConfig, getSequences, updateSequence, updateConfig };
}

const ready = () => screen.findByRole('heading', { name: 'Member Numbering' });
const numbers = (code: string, n: number, width = 4) => `${code}-${YEAR}-${String(n).padStart(width, '0')}`;

describe('MemberNumberingPage — data states', () => {
  it('shows a skeleton while loading', () => {
    renderNumbering({ getConfig: vi.fn().mockReturnValue(new Promise(() => undefined)) });
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('a network failure loading the config offers Retry and recovers', async () => {
    const getConfig = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(CONFIG);
    const { user } = renderNumbering({ getConfig });
    expect(await screen.findByText("Couldn't load member numbering settings — check your connection and try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await ready()).toBeInTheDocument();
  });

  it('a generic failure never shows the raw error', async () => {
    renderNumbering({ getConfig: vi.fn().mockRejectedValue(new Error('PGRST raw')) });
    expect(await screen.findByText('Something went wrong loading member numbering settings. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/PGRST/)).not.toBeInTheDocument();
  });

  it('a failure loading just the sequences keeps the settings form visible with its own Retry', async () => {
    const getSequences = vi.fn().mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValue(SEQUENCES);
    const { user } = renderNumbering({ getSequences });
    // config loaded first, so the page shell is up even though the sequences are not
    expect(await ready()).toBeInTheDocument();
    expect(await screen.findByText("Couldn't load sequences — check your connection and try again.")).toBeInTheDocument();
    expect(screen.getByLabelText('Start sequence')).toHaveValue('1');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(numbers('MUM', 42))).toBeInTheDocument();
  });
});

describe('MemberNumberingPage renders exactly ONE of table / cards', () => {
  it('on desktop: a table with a row per branch, no cards', async () => {
    renderNumbering({ viewport: 1280 });
    await ready();
    await screen.findByText(numbers('MUM', 42));
    expect(document.querySelectorAll('table')).toHaveLength(1);
    expect(within(document.querySelector('table') as HTMLElement).getAllByRole('row')).toHaveLength(SEQUENCES.length + 1);
    expect(document.querySelector('.member-numbering-cards')).toBeNull();
  });

  it('on a phone: cards, one per branch, no table', async () => {
    renderNumbering({ viewport: MOBILE_WIDTH });
    await ready();
    await screen.findByText(numbers('MUM', 42));
    expect(document.querySelectorAll('table')).toHaveLength(0);
    expect(document.querySelectorAll('.member-numbering-card')).toHaveLength(SEQUENCES.length);
  });
});

describe('MemberNumberingPage — per-branch sequences', () => {
  it('previews last issued and next number, padded, and says "None yet" for a fresh branch', async () => {
    renderNumbering({ viewport: 1280 });
    await ready();
    const mumbai = (await screen.findByText(/Mumbai Central/)).closest('tr') as HTMLElement;
    expect(within(mumbai).getByText(numbers('MUM', 41))).toBeInTheDocument();
    expect(within(mumbai).getByText(numbers('MUM', 42))).toBeInTheDocument();

    const pune = screen.getByText(/Pune Camp/).closest('tr') as HTMLElement;
    expect(within(pune).getByText('None yet')).toBeInTheDocument();
    expect(within(pune).getByText(numbers('PUN', 1))).toBeInTheDocument();
  });

  it('honours the configured padding width in the preview', async () => {
    renderNumbering({ viewport: 1280, config: { ...CONFIG, padding_width: 6 } });
    await ready();
    expect(await screen.findByText(numbers('MUM', 42, 6))).toBeInTheDocument();
  });

  it('editing prefills the next number, masks it to digits, and saves via the Edge-Function repository call', async () => {
    const { user, updateSequence, getConfig } = renderNumbering({ viewport: 1280 });
    await ready();
    const row = (await screen.findByText(/Mumbai Central/)).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Edit/ }));

    const input = within(row).getByRole('textbox');
    expect(input).toHaveValue('42');
    await user.clear(input);
    await user.type(input, '5a0');
    expect(input).toHaveValue('50');

    const [, save] = within(row).getAllByRole('button');
    await user.click(save);
    expect(updateSequence).toHaveBeenCalledWith(1, 50);
    await vi.waitFor(() => expect(getConfig).toHaveBeenCalledTimes(2)); // reloaded
  });

  it('refuses 0 or blank without calling the server', async () => {
    const { user, updateSequence } = renderNumbering({ viewport: 1280 });
    await ready();
    const row = (await screen.findByText(/Mumbai Central/)).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Edit/ }));
    await user.clear(within(row).getByRole('textbox'));
    await user.click(within(row).getAllByRole('button')[1]);

    expect(within(row).getByText('Enter a whole number, at least 1')).toBeInTheDocument();
    expect(updateSequence).not.toHaveBeenCalled();
  });

  it('tells the user when the server moved their number forward because it was already issued', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const updateSequence = vi.fn().mockResolvedValue({ next_sequence: 57, requested: 50, adjusted: true });
    const { user } = renderNumbering({ updateSequence, viewport: 1280 });
    await ready();
    const row = (await screen.findByText(/Mumbai Central/)).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Edit/ }));
    await user.clear(within(row).getByRole('textbox'));
    await user.type(within(row).getByRole('textbox'), '50');
    await user.click(within(row).getAllByRole('button')[1]);

    await vi.waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert).toHaveBeenCalledWith('Mumbai Central: 50 was already used for this branch — set to 57 instead.');
  });

  it.each([
    ['offline', new Error('Failed to fetch'), "Couldn't save — check your connection and try again."],
    ['a server message', new Error('Branch not found'), 'Branch not found'],
  ])('shows a specific message when saving fails (%s) and keeps editing', async (_label, error, message) => {
    const { user } = renderNumbering({ updateSequence: vi.fn().mockRejectedValue(error), viewport: 1280 });
    await ready();
    const row = (await screen.findByText(/Mumbai Central/)).closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Edit/ }));
    await user.click(within(row).getAllByRole('button')[1]);

    expect(await within(row).findByText(message)).toBeInTheDocument();
    expect(within(row).getByRole('textbox')).toBeInTheDocument();
  });

  it('works from a phone card, and Cancel abandons the edit', async () => {
    const { user, updateSequence } = renderNumbering({ viewport: MOBILE_WIDTH });
    await ready();
    const card = (await screen.findByText('Mumbai Central')).closest('.member-numbering-card') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: /Edit/ }));
    expect(within(card).getByRole('textbox')).toHaveValue('42');

    await user.click(within(card).getAllByRole('button')[0]); // the X
    expect(within(card).queryByRole('textbox')).not.toBeInTheDocument();
    expect(updateSequence).not.toHaveBeenCalled();
  });
});

describe('MemberNumberingPage — global settings', () => {
  it('shows the current config in the form', async () => {
    renderNumbering({ config: { start_sequence: 100, increment: 5, padding_width: 6 } });
    await ready();
    expect(await screen.findByLabelText('Start sequence')).toHaveValue('100');
    expect(screen.getByLabelText('Increment')).toHaveValue('5');
    expect(screen.getByLabelText('Padding width')).toHaveValue('6');
  });

  it('keeps each field to digits and caps its length', async () => {
    const { user } = renderNumbering();
    await ready();
    const width = await screen.findByLabelText('Padding width');
    await user.clear(width);
    await user.type(width, '1a234');
    expect(width).toHaveValue('12'); // digits only, max 2
  });

  it('validates on submit and does not save an invalid config', async () => {
    const { user, updateConfig } = renderNumbering();
    await ready();
    const start = await screen.findByLabelText('Start sequence');
    await user.clear(start);
    await user.clear(screen.getByLabelText('Padding width'));
    await user.type(screen.getByLabelText('Padding width'), '11');
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(screen.getByText('Enter a whole number, at least 1')).toBeInTheDocument();
    expect(screen.getByText('Enter a whole number from 1 to 10')).toBeInTheDocument();
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it('saves, confirms, and reloads from the server', async () => {
    const { user, updateConfig, getConfig } = renderNumbering();
    await ready();
    const increment = await screen.findByLabelText('Increment');
    await user.clear(increment);
    await user.type(increment, '5');
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(updateConfig).toHaveBeenCalledWith({ start_sequence: '1', increment: '5', padding_width: '4' });
    expect(await screen.findByText('Settings saved.')).toBeInTheDocument();
    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['offline', new Error('Failed to fetch'), "Couldn't save these settings — check your connection and try again."],
    ['anything else', new Error('boom'), 'Something went wrong saving these settings. Please try again.'],
  ])('shows a specific message when saving fails (%s) and reconciles from the server', async (_label, error, message) => {
    const { user, getConfig } = renderNumbering({ updateConfig: vi.fn().mockRejectedValue(error) });
    await ready();
    await screen.findByLabelText('Increment');
    await user.click(screen.getByRole('button', { name: 'Save Settings' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Settings saved.')).not.toBeInTheDocument();
    // The response could have been lost AFTER the server committed, so the page re-reads the truth.
    await vi.waitFor(() => expect(getConfig).toHaveBeenCalledTimes(2));
  });
});
