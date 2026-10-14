import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDocumentTypeOfVersion: vi.fn(),
  registerFieldDefinitions: vi.fn(),
}));
vi.mock('@visastack/services', () => ({
  getDocumentTypeOfVersion: mocks.getDocumentTypeOfVersion,
  registerFieldDefinitions: mocks.registerFieldDefinitions,
}));

const { ensureDocumentFieldsRegistered, fieldDefinitionInputs } = await import('./field-registry');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.registerFieldDefinitions.mockResolvedValue(0);
});

describe('field definitions from names', () => {
  it('describes a live field and a catalogue field, once each, and skips a name nobody knows', () => {
    const inputs = fieldDefinitionInputs([
      'passport_number',
      'passport_number',
      'other_item_study_title',
      'made_up_field',
    ]);
    expect(inputs.map((input) => input.key)).toEqual(['passport_number', 'other_item_study_title']);
    expect(inputs[0]?.packId).toBe('universal');
    expect(inputs[1]).toMatchObject({ packId: 'study', repeating: true, dataType: 'string' });
  });
});

describe('registering the fields a document carries before an AI reading', () => {
  it('registers only the fields the document type carries', async () => {
    mocks.getDocumentTypeOfVersion.mockResolvedValue('PASSPORT');
    mocks.registerFieldDefinitions.mockResolvedValue(3);
    const added = await ensureDocumentFieldsRegistered({} as never, 'version-1');
    expect(added).toBe(3);
    const inputs = mocks.registerFieldDefinitions.mock.calls[0]?.[1] as { key: string }[];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.length).toBeLessThan(60);
    expect(inputs.map((input) => input.key)).toContain('passport_number');
  });

  it('registers nothing for a document with no type', async () => {
    mocks.getDocumentTypeOfVersion.mockResolvedValue(null);
    expect(await ensureDocumentFieldsRegistered({} as never, 'version-1')).toBe(0);
    expect(mocks.registerFieldDefinitions).not.toHaveBeenCalled();
  });

  it('registers nothing for a type the catalogue has no field list for', async () => {
    mocks.getDocumentTypeOfVersion.mockResolvedValue('NOT_A_TYPE_ANYONE_KNOWS');
    expect(await ensureDocumentFieldsRegistered({} as never, 'version-1')).toBe(0);
    expect(mocks.registerFieldDefinitions).not.toHaveBeenCalled();
  });
});
