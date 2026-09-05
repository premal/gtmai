import { describe, expect, it } from 'vitest';
import { renderSequenceTemplate } from './sequences';

describe('sequence rendering', () => {
  it('renders contact, company, and nested contact data bindings', () => {
    expect(
      renderSequenceTemplate(
        'Hi {{contact.firstName}} at {{company.name}} — {{contact.data.title}}',
        { firstName: 'Ada', data: { title: 'Engineer' } },
        { name: 'Analytical Engines' },
      ),
    ).toBe('Hi Ada at Analytical Engines — Engineer');
  });
});
