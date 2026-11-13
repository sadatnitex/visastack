import { describe, expect, it } from 'vitest';
import { COMPANION_UNAVAILABLE } from '../access/trip-companion-access';
import { keyedError } from '../errors';
import { CASE_FINISHED_NO_CHANGE } from '../missions';
import { REVIEW_GENERAL_NOTE_LIMIT, REVIEW_NOTE_LIMIT } from '../umpe-collection-response-review';
import { GUEST_CODE_MAX_ATTEMPTS } from '../umpe-guest-collection';
import { COMPANION_PAPERS_NOT_AVAILABLE } from '../umpe-trip-companion-papers';
import { COMPANION_NAME_PROBLEM, COMPANION_NOT_SWITCHED_ON } from '../umpe-trip-companions';
import { serviceMessages } from './messages';

/**
 * The guest code and review note refusals moved onto keys. Each one's English must be the exact
 * sentence the service always returned, numbers included, written out here (the old template
 * code, line for line) so a rewording or a grouped number cannot pass silently.
 */
describe('guest code and review note refusals keep their English', () => {
  it('the guest code refusals', () => {
    expect(
      keyedError('invalid', 'umpe_guest_collection.enter_the_six_digits_from_the').message,
    ).toBe('Enter the six digits from the email.');
    expect(
      keyedError('invalid', 'umpe_guest_collection.this_code_has_expired_or_was').message,
    ).toBe('This code has expired or was replaced. Ask for a new code.');
    expect(keyedError('invalid', 'umpe_guest_collection.that_code_has_had_too_many').message).toBe(
      'That code has had too many tries. Ask for a new code.',
    );
    expect(keyedError('invalid', 'umpe_guest_collection.this_link_can_no_longer_be').message).toBe(
      'This link can no longer be opened without an account. Ask the agency for a new link.',
    );
  });

  it('the wrong-code line, for every count of tries left, and a large one', () => {
    for (const left of [
      ...Array.from({ length: GUEST_CODE_MAX_ATTEMPTS }, (_, i) => i + 1),
      1234,
    ]) {
      const old = `That code is not right. Check the newest email and try again (${left} ${left === 1 ? 'try' : 'tries'} left).`;
      const keyed = keyedError('invalid', 'umpe_guest_collection.that_code_is_not_right', { left });
      expect(keyed.message).toBe(old);
      expect(keyed.params).toEqual({ left });
    }
  });

  it('the review note refusals, with the real limits', () => {
    expect(
      keyedError('invalid', 'umpe_collection_response_review.keep_the_note_to', {
        max: REVIEW_GENERAL_NOTE_LIMIT,
      }).message,
    ).toBe(`Keep the note to ${REVIEW_GENERAL_NOTE_LIMIT} characters.`);
    expect(
      keyedError('invalid', 'umpe_collection_response_review.keep_each_note_to', {
        max: REVIEW_NOTE_LIMIT,
      }).message,
    ).toBe(`Keep each note to ${REVIEW_NOTE_LIMIT} characters.`);
    expect(
      keyedError('invalid', 'umpe_collection_response_review.choose_an_item_from_the_list').message,
    ).toBe('Choose an item from the list.');
    expect(
      keyedError('invalid', 'umpe_collection_response_review.too_many_notes_at_once').message,
    ).toBe('Too many notes at once.');
  });

  it('the shown service constants read from the list and keep their exact English', () => {
    expect(COMPANION_UNAVAILABLE).toBe('This invitation is not available.');
    expect(COMPANION_NOT_SWITCHED_ON).toBe('Travelling with someone else is not switched on yet.');
    expect(COMPANION_NAME_PROBLEM).toBe('Enter a name of up to 120 characters.');
    expect(COMPANION_PAPERS_NOT_AVAILABLE).toBe('Choosing papers is not switched on yet.');
    expect(CASE_FINISHED_NO_CHANGE).toBe('This case is finished, so it can no longer change.');
  });

  it('the wrong-code line has no Bengali until the register has a matching draft', () => {
    // No register row has this English yet, so the refill tool leaves it English.
    expect(serviceMessages.bn['umpe_guest_collection.that_code_is_not_right']).toBeUndefined();
  });
});
